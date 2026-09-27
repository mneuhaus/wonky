import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishRenderGeneration } from '../src/render-publication.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const images = report => [report.overview, ...report.views.flatMap(view => Object.values(view.images))];
const fixture = (directory, label) => {
  fs.mkdirSync(directory, { recursive: true });
  const write = (file, bytes) => {
    fs.writeFileSync(join(directory, file), bytes);
    return { file, sha256: hash(bytes) };
  };
  const camera = { schema: 'wonky.render-camera/1', size: 64, views: [{ name: 'front' }] };
  const report = {
    schema: 'wonky.visual-comparison/1',
    inputs: ['before', 'after'].map(name => {
      const { file, sha256 } = write(`${name}.display.stl`, `${label} ${name} mesh`);
      return { path: join(directory, file), sha256 };
    }),
    camera,
    overview: write('comparison.png', `${label} overview`),
    views: [{ name: 'front', images: Object.fromEntries(['before', 'after', 'diff'].map(name => [name, write(`0-${name}.png`, `${label} ${name} image`)])) }]
  };
  write('camera.json', JSON.stringify(camera));
  write('renderer.log', `${label} renderer complete`);
  write('report.json', JSON.stringify(report));
  return report;
};
const verify = (out, report) => {
  const directory = report.assetGeneration ? join(out, report.assetGeneration.directory) : out;
  for (const image of images(report)) assert.equal(hash(fs.readFileSync(join(directory, image.file))), image.sha256);
  for (const input of report.inputs) assert.equal(hash(fs.readFileSync(input.path)), input.sha256);
  assert.deepEqual(JSON.parse(fs.readFileSync(report.cameraFile ?? join(directory, 'camera.json'))), report.camera);
};
const generationBytes = directory => Object.fromEntries(fs.readdirSync(directory).sort().map(file => [file, fs.readFileSync(join(directory, file), 'hex')]));
const workspace = t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'wonky-render-publication-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test('generation publication replaces a legacy report without touching its assets or unrelated paths', t => {
  const root = workspace(t), out = join(root, 'output'), staging = join(root, 'staging');
  const previous = fixture(out, 'legacy');
  fs.unlinkSync(join(out, 'renderer.log'));
  fs.mkdirSync(join(out, 'renderer.log'));
  fs.writeFileSync(join(out, 'renderer.log', 'preserve.txt'), 'unrelated directory');
  const report = fixture(staging, 'new');
  const published = publishRenderGeneration({ staging, out, report });
  assert.match(published.assetGeneration.id, /^[a-f0-9]{64}$/);
  assert.equal(published.assetGeneration.directory, `generations/${published.assetGeneration.id}`);
  const generation = join(out, published.assetGeneration.directory);
  assert.equal(published.cameraFile, join(generation, 'camera.json'));
  assert.deepEqual(published.inputs.map(input => input.path), ['before.display.stl', 'after.display.stl'].map(file => join(generation, file)));
  assert.deepEqual(fs.readFileSync(join(out, 'report.json')), fs.readFileSync(join(generation, 'report.json')));
  assert.equal(fs.readFileSync(join(out, 'renderer.log', 'preserve.txt'), 'utf8'), 'unrelated directory');
  verify(out, previous);
  verify(out, published);
});

test('failed report commit preserves the prior generation, and a later replacement succeeds', t => {
  const root = workspace(t), out = join(root, 'output');
  const firstStage = join(root, 'first'), first = publishRenderGeneration({ staging: firstStage, out, report: fixture(firstStage, 'first') });
  const firstDirectory = join(out, first.assetGeneration.directory), originalGeneration = generationBytes(firstDirectory);
  const originalReport = fs.readFileSync(join(out, 'report.json'));
  const rename = fs.renameSync;
  let failedCommits = 0;
  const mock = t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === join(out, 'report.json')) {
      failedCommits++;
      throw Object.assign(new Error('forced report commit failure'), { code: 'EACCES' });
    }
    return rename(from, to);
  });
  const failedStage = join(root, 'failed'), failedReport = fixture(failedStage, 'failed');
  assert.throws(() => publishRenderGeneration({ staging: failedStage, out, report: failedReport }), /forced report commit failure/);
  assert.equal(failedCommits, 1);
  mock.mock.restore();
  assert.deepEqual(fs.readFileSync(join(out, 'report.json')), originalReport);
  assert.deepEqual(generationBytes(firstDirectory), originalGeneration);
  verify(out, first);
  const retained = fs.readdirSync(join(out, 'generations'));
  assert.equal(retained.length, 2, 'the complete unpublished generation remains available');
  for (const id of retained) verify(out, JSON.parse(fs.readFileSync(join(out, 'generations', id, 'report.json'))));
  assert.ok(!fs.readdirSync(out).some(file => file.startsWith('.wonky-report-')));

  const nextStage = join(root, 'next'), next = publishRenderGeneration({ staging: nextStage, out, report: fixture(nextStage, 'next') });
  assert.deepEqual(JSON.parse(fs.readFileSync(join(out, 'report.json'))), next);
  assert.notEqual(next.assetGeneration.id, first.assetGeneration.id);
  assert.deepEqual(generationBytes(firstDirectory), originalGeneration);
  verify(out, first);
  verify(out, next);
  assert.equal(fs.readdirSync(join(out, 'generations')).length, 3);
});

test('incomplete or corrupted render assets cannot replace a valid report', t => {
  const root = workspace(t), out = join(root, 'output'), firstStage = join(root, 'first');
  const first = publishRenderGeneration({ staging: firstStage, out, report: fixture(firstStage, 'first') });
  const originalReport = fs.readFileSync(join(out, 'report.json'));
  for (const failure of ['missing image', 'corrupted mesh', 'mismatched camera']) {
    const staging = join(root, failure), report = fixture(staging, failure);
    if (failure === 'missing image') fs.unlinkSync(join(staging, '0-diff.png'));
    if (failure === 'corrupted mesh') fs.writeFileSync(join(staging, 'before.display.stl'), 'corrupted');
    if (failure === 'mismatched camera') fs.writeFileSync(join(staging, 'camera.json'), '{}');
    assert.throws(() => publishRenderGeneration({ staging, out, report }), /Missing render asset|Render asset hash mismatch|camera does not match/);
    assert.deepEqual(fs.readFileSync(join(out, 'report.json')), originalReport);
    verify(out, first);
    assert.equal(fs.readdirSync(join(out, 'generations')).length, 1);
  }
});
