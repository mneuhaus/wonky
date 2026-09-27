// The real STEP consumer owns this contract: analytic blend carriers must
// reimport without healing beyond the declared budget, with native metrics and
// topology preserved. It catches correct native metrics beside broken STEP
// planes, circle sense, or cylinder trims. No mocked oracle or production seam.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { toStep } = await import('../src/exporters.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));

test('rolling-ball STEP reimports with exact incidence checks and its stated tolerance', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-fillet-step-'));
  const prefixes = [];
  try {
    for (const [kind, size, point, skew = false] of [
      ['single', [16, 16, 16], [0, 0, 8]],
      ['paired', [16, 16, 16], [0, 0, 8]],
      ['skew-single', [16, 16, 16], [0, 0, 8], true],
      ['skew-paired', [16, 16, 16], [0, 0, 8], true],
      ['corner', [16, 16, 16], [0, 0, 0]],
      ['skew-corner', [16, 16, 16], [0, 0, 0], true],
      ['skew-critical', [4, 4, 4], [4, 4, 4], true],
      ['critical-one', [4, 8, 16], [0, 0, 0]],
      ['critical-two', [4, 4, 16], [0, 0, 0]],
      ['critical-three', [4, 4, 4], [0, 0, 0]],
      ['critical-reflected', [4, 4, 4], [4, 4, 4]],
    ]) {
      const source = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  fCuboid(context,id+"box",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(${size.join(',')})*millimeter});
  const body=qCreatedBy(id+"box",EntityType.BODY);
  const base=coordSystem(vector(65536.25,-32768.5,16384.125)*millimeter,vector(0,0,1),vector(0,-1,0));
  const turn=rotationAround(line(vector(3,-2,5)*millimeter,vector(1,2,3)),0.1*radian);
  const zero=turn*(vector(0,0,0)*millimeter);
  const cs=${skew ? 'coordSystem(base.origin+zero,(turn*(vector(1,0,0)*millimeter)-zero)/millimeter,(turn*(vector(0,0,1)*millimeter)-zero)/millimeter)' : 'base'};
  opTransform(context,id+"pose",{"bodies":body,"transform":toWorld(cs)});
  opFillet(context,id+"first",{"entities":qClosestTo(qOwnedByBody(body,EntityType.EDGE),toWorld(cs,vector(${point.join(',')})*millimeter)),"radius":4*millimeter});
  ${kind.endsWith('paired') ? 'opFillet(context,id+"second",{"entities":qClosestTo(qOwnedByBody(body,EntityType.EDGE),toWorld(cs,vector(16,0,8)*millimeter)),"radius":12*millimeter});' : ''}
});`;
      const model = await build(source, { feature: 'f' });
      const prefix = path.join(dir, kind);
      fs.writeFileSync(prefix + '.step', toStep(model, 'rounded'));
      fs.writeFileSync(prefix + '.brep.json', serializeModel(model));
      prefixes.push(prefix);
    }
    const result = spawnSync('uv', ['run', path.join(root, 'scripts/validate-step.py'), ...prefixes], {
      cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.equal(JSON.parse(result.stdout).length, prefixes.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
