// The viewer server on the Rust kernel, end to end: the live server builds
// examples/box.fs (planar), examples/bored-spacer.fs (curved), a bolt-circle flange
// (a stacked-prism body), a three-body model, a revolved cone and a hemisphere, and
// what it serves (model payload, parts facts, geometry rows, measurements, print
// export) is checked against `bin/wonky.mjs --json` of the same source. A number read
// from the display mesh must NOT pass this check (planted negative below).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createReviewServer } from '../src/review-server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const SOURCES = {
  box: 'examples/box.fs',
  'bored-spacer': 'examples/bored-spacer.fs',
  'bolt-flange': 'scripts/viewer/qa/fixtures/bolt-flange.fs',
  'hole-boss': 'scripts/viewer/qa/fixtures/hole-boss.fs',
  'conical-spacer': 'fixtures/cli-export/conical-spacer.fs',
  hemisphere: 'fixtures/cli-export/hemisphere.fs',
};

async function cli(source, out) {
  const { stdout } = await run(process.execPath,
    [join(root, 'bin/wonky.mjs'), source, '--json', '--out', join(out, 'cli')], { cwd: root });
  return JSON.parse(stdout).bodies;
}

async function session(t, name) {
  const dir = await mkdtemp(join(tmpdir(), 'wonky-viewer-rust-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const source = join(dir, `${name}.fs`);
  await copyFile(join(root, SOURCES[name]), source);
  const server = await createReviewServer({
    sources: [{ path: source }], port: 0, reviewDirectory: join(dir, 'reviews'),
    stateDirectory: join(dir, 'state'), live: { debounceMs: 30, pool: { spare: false } },
  });
  t.after(() => server.close());
  const modelId = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no revision within 120 s')), 120000);
    server.events.subscribe(event => {
      if (event.name === 'revision' && event.data.revision === 1) { clearTimeout(timer); resolve(event.data.modelId); }
      if (event.name === 'build-failed') { clearTimeout(timer); reject(new Error(JSON.stringify(event.data.failure))); }
    });
  });
  const api = async (path, body) => {
    const response = await fetch(server.origin + path, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = (response.headers.get('content-type') ?? '').includes('json');
    return { status: response.status, json: json ? await response.json() : null, bytes: json ? null : Buffer.from(await response.arrayBuffer()) };
  };
  return { dir, source, server, modelId, api, expected: await cli(source, dir) };
}

// Volume of the display triangles (divergence theorem), the number a viewer
// would show if it measured the mesh instead of asking the kernel.
function meshVolume(bodyScene) {
  let sum = 0;
  for (const face of bodyScene.faces) {
    for (const { points: [a, b, c] } of face.triangles) {
      sum += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
  }
  return sum;
}

// The check under test: every reported number equals the CLI's, exactly.
function matchesCli(reported, expected) {
  assert.equal(reported.volumeMm3, expected.volumeMm3, 'volume');
  assert.equal(reported.areaMm2, expected.areaMm2, 'area');
  assert.deepEqual(reported.bboxMm, expected.bboxMm, 'bbox');
}

for (const name of ['box', 'bored-spacer']) {
  test(`viewer server on Rust: ${name} model, facts and measurement match bin/wonky.mjs --json`, { timeout: 240000 }, async t => {
    const { modelId, api, expected } = await session(t, name);
    assert.equal(expected.length, 1);
    assert.equal(expected[0].geometry, 'rust-wc0-v3', 'the CLI built a Rust body');

    const model = await api(`/api/models/${modelId}`);
    assert.equal(model.status, 200);
    assert.equal(model.json.bodies[0].faces.length, expected[0].topology.faces);
    assert.ok(model.json.bodies[0].faces.every(face => face.triangles.length > 0), 'every face has display triangles');
    assert.deepEqual(model.json.display.notes, [], 'no display warning when every face is shown');
    assert.ok(model.json.display.toleranceMm > 0, 'the display states its chordal deviation');
    assert.match(model.json.display.purpose, /Rust/);

    const parts = await api(`/api/models/${modelId}/parts`);
    assert.equal(parts.status, 200);
    const facts = parts.json.bodies[0].kernelFacts;
    assert.equal(facts.source, 'rust-kernel-measure');
    matchesCli(facts, expected[0]);
    assert.equal(facts.volumeRelBound, expected[0].volumeRelBound);

    const geometry = await api(`/api/models/${modelId}/geometry`);
    assert.equal(geometry.status, 200);
    assert.match(geometry.json.method, /Rust/);
    const areaSum = geometry.json.faces.reduce((sum, face) => sum + face.areaMm2, 0);
    assert.ok(Math.abs(areaSum - expected[0].areaMm2) <= expected[0].areaMm2 * 1e-12, 'face areas add up to the body area');
    assert.ok(geometry.json.faces.every(face => face.measure === 'rust-kernel-measure'));

    // A measurement: the two largest parallel planes (box) or the outer cylinder (bored-spacer).
    const bbox = expected[0].bboxMm;
    if (name === 'box') {
      const planes = geometry.json.faces.filter(face => face.surface.type === 'plane');
      const x = planes.filter(face => Math.abs(face.outwardNormal[0]) === 1);
      assert.equal(x.length, 2);
      const measured = await api(`/api/models/${modelId}/measure`, {
        entities: x.map(face => ({ modelId, alias: face.alias })),
      });
      assert.equal(measured.status, 200);
      const distance = measured.json.measurements.find(row => row.quantity === 'parallelOffset');
      assert.equal(distance.value, bbox.max[0] - bbox.min[0], 'plane distance equals the CLI bbox width');
      assert.equal(distance.unit, 'mm');
      assert.match(distance.method, /binary64 over the Rust carriers/);
    } else {
      const cylinders = geometry.json.faces.filter(face => face.surface.type === 'cylinder');
      const outer = cylinders.reduce((a, b) => (b.surface.radiusMm > a.surface.radiusMm ? b : a));
      assert.equal(outer.surface.diameterMm, bbox.max[0] - bbox.min[0], 'outer diameter equals the CLI bbox width');
      const measured = await api(`/api/models/${modelId}/measure`, {
        entities: cylinders.map(face => ({ modelId, alias: face.alias })),
      });
      assert.equal(measured.status, 200);
      assert.ok(measured.json.measurements.length > 0, 'cylinder pair measured');
      assert.ok(measured.json.measurements.every(row => row.exactness === 'exact-parameters' && row.method));
    }

    // Print export from the Rust mesh path: planar faces are their own triangles (0 mm).
    const printed = await api(`/api/models/${modelId}/print.json`);
    assert.equal(printed.status, 200, JSON.stringify(printed.json));
    assert.equal(printed.json.deviation.achievedMm, name === 'box' ? 0 : 0.02);
  });
}

// A stacked-prism body (bolt-circle flange), a three-body model and two full revolves
// (a cone and a hemisphere, whose record projection carries chart seams the WC0 body does
// not): every face of every body has display triangles and every circle edge is sampled,
// per-body kernel facts equal the CLI, and the print export is the Rust mesh with its
// stated deviation.
for (const name of ['bolt-flange', 'hole-boss', 'conical-spacer', 'hemisphere']) {
  test(`viewer server on Rust: ${name} shows every face and edge; per-body facts match bin/wonky.mjs --json`, { timeout: 240000 }, async t => {
    const { modelId, api, expected } = await session(t, name);
    const model = await api(`/api/models/${modelId}`);
    assert.equal(model.status, 200);
    assert.equal(model.json.bodies.length, expected.length);
    assert.deepEqual(model.json.display.notes, [], 'no display warning');
    const parts = await api(`/api/models/${modelId}/parts`);
    model.json.bodies.forEach((body, i) => {
      assert.equal(body.faces.length, expected[i].topology.faces, body.id);
      assert.ok(body.faces.every(face => face.triangles.length > 0 && face.displayTessellation?.source === 'rust-mesh'),
        `${body.id}: every face has Rust mesh triangles`);
      const circles = body.edges.filter(edge => edge.curveType === 'circle');
      assert.ok(circles.length > 0 && circles.every(edge => edge.points.length > 2), `${body.id}: circle edges are sampled`);
      matchesCli(parts.json.bodies[i].kernelFacts, expected[i]);
    });

    if (name === 'bolt-flange') {
      // Six holes on a 44 mm bolt circle: pairwise axis distances 44 sin(k pi / 6),
      // six of 22, six of 22 sqrt 3 and three of 44, each within its stated tolerance.
      const geometry = await api(`/api/models/${modelId}/geometry`);
      const holes = geometry.json.faces.filter(face => face.surface.type === 'cylinder' && face.surface.radiusMm === 3);
      assert.equal(holes.length, 6);
      const chords = [22, 22 * Math.sqrt(3), 44], found = [0, 0, 0];
      for (let a = 0; a < 6; a++) {
        for (let b = a + 1; b < 6; b++) {
          const measured = await api(`/api/models/${modelId}/measure`, { entities: [holes[a], holes[b]].map(face => ({ modelId, alias: face.alias })) });
          const row = measured.json.measurements.find(item => item.quantity === 'axisDistance');
          const hit = chords.findIndex(d => Math.abs(row.value - d) <= row.toleranceMm);
          assert.ok(hit >= 0, `${holes[a].alias}-${holes[b].alias}: ${row.value} mm is no bolt-circle chord within ${row.toleranceMm} mm`);
          found[hit]++;
        }
      }
      assert.deepEqual(found, [6, 6, 3]);
    }

    const manifest = await api(`/api/models/${modelId}/print.json`);
    assert.equal(manifest.status, 200, JSON.stringify(manifest.json));
    assert.equal(manifest.json.deviation.achievedMm, 0.02);
    assert.match(manifest.json.deviation.statement, /stated by the Rust mesh path/);
    assert.ok(manifest.json.printMesh.bodies.every(body => body.meshSource === 'rust-mesh'));
    const stl = await api(`/api/models/${modelId}/print.stl`);
    assert.equal(stl.status, 200);
    assert.equal(createHash('sha256').update(stl.bytes).digest('hex'), manifest.json.file.sha256, 'the manifest describes this STL');
    assert.equal((stl.bytes.toString('utf8').match(/  facet normal /g) ?? []).length,
      manifest.json.printMesh.bodies.reduce((sum, body) => sum + body.triangles, 0));
  });
}

test('planted negative: a volume read from the display mesh fails the CLI comparison', { timeout: 240000 }, async t => {
  const { modelId, api, expected } = await session(t, 'bored-spacer');
  const model = await api(`/api/models/${modelId}`);
  const fromMesh = { ...expected[0], volumeMm3: meshVolume(model.json.bodies[0]) };
  assert.notEqual(fromMesh.volumeMm3, expected[0].volumeMm3, 'the curved display mesh does not reproduce the kernel volume');
  assert.throws(() => matchesCli(fromMesh, expected[0]), /volume/);
  const parts = await api(`/api/models/${modelId}/parts`);
  assert.doesNotThrow(() => matchesCli(parts.json.bodies[0].kernelFacts, expected[0]), 'the kernel-backed facts pass');
});

test('viewer server on Rust: section and thickness say so instead of falling back', { timeout: 240000 }, async t => {
  const { modelId, api } = await session(t, 'box');
  const section = await api(`/api/models/${modelId}/section`, { origin: [20, 10, 2], normal: [0, 0, 1] });
  assert.equal(section.status, 501);
  assert.match(section.json.error, /^unsupported on Rust: /);
  const thickness = await api(`/api/models/${modelId}/thickness`, { origin: [20, 10, 2], direction: [0, 0, 1] });
  assert.equal(thickness.status, 501);
  assert.match(thickness.json.error, /^unsupported on Rust: /);
});

for (const name of ['box', 'bored-spacer']) {
  test(`html export on Rust: ${name} states its mesh deviation and the kernel volume`, { timeout: 240000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wonky-viewer-rust-html-'));
    t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    const prefix = join(dir, name);
    await run(process.execPath, [join(root, 'bin/wonky.mjs'), join(root, 'examples', `${name}.fs`), '--format', 'html', '--out', prefix], { cwd: root });
    const html = await readFile(`${prefix}.html`, 'utf8');
    const [expected] = await cli(join(root, 'examples', `${name}.fs`), dir);
    assert.match(html, /0\.02 mm; volume from the Rust kernel measurement/);
    const printed = Number(/measurement<br>([\d,.]+) mm³/.exec(html)?.[1].replaceAll(',', ''));
    assert.ok(Math.abs(printed - expected.volumeMm3) <= 0.05, `printed ${printed} mm³, kernel ${expected.volumeMm3} mm³ (page rounds to 0.1)`);
    assert.doesNotMatch(html, /https?:\/\//, 'no external resources');
  });
}
