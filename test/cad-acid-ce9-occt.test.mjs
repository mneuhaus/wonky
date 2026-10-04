import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../scripts/acid/common.mjs';

test('seam-oriented native OCCT blend preserves the strict AC36 topology through STEP', {skip: !process.getBuiltinModule('node:fs').existsSync(new URL('../out/build123d-performance/reference-venv/bin/python', import.meta.url)) && 'REFERENCE_VENV_UNAVAILABLE: build123d/OCCT reference observer'},() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce9-seam-'));
  try {
    const program = `import sys, math
sys.path[:0]=[sys.argv[1]+'/scripts/acid',sys.argv[1]+'/fixtures/cad-acid/b3d']
from acid_blend_ce9 import build, cylinder_with_seam
from acid_blend import frame_for
from measure import canonical, export_step, read_step
from OCP.BRepCheck import BRepCheck_Analyzer
for variant in ['V0','V1','V2','V3']:
 solid=build(variant)[0]
 assert solid.is_valid
 filename=sys.argv[2]+'/'+variant+'.step'
 export_step(solid.wrapped,filename)
 for stage,shape,resolution in [('native',solid.wrapped,0),('STEP',read_step(filename),1e-7)]:
  t,raw,h=canonical(shape,coordinate_resolution=resolution)
  assert BRepCheck_Analyzer(shape).IsValid(),(variant,stage)
  assert [t[k] for k in ['bodies','shells','faces','edges','vertices']]==[1,1,6,5,0],(variant,stage,t,raw)
  assert h=={'Cylinder':2,'Plane':3,'BSplineSurface':1},(variant,stage,h)
  assert t['genus']==0 and t['singularPoints']==0 and t['pinchPoints']==0
 assert 5240.603798260648 < solid.volume < 5250.834980522562,(variant,solid.volume)
# The primitive helper works for each coordinate axis and rejects an axial seam.
f=frame_for('AC36','V0')
for axis,radial in [((1,0,0),(0,1,0)),((0,1,0),(0,0,1)),((0,0,1),(1,0,0))]:
 for sign in [-1,1]:
  cylinder=cylinder_with_seam(f,3,[-2,5],axis,tuple(sign*x for x in radial))
  assert abs(cylinder.volume-63*math.pi)<1e-9
 try: cylinder_with_seam(f,3,[-2,5],axis,axis)
 except ValueError as e: assert 'parallel' in str(e)
 else: raise AssertionError('axial seam accepted')
print('four native and STEP blends satisfy the unchanged contract')`;
    const run = spawnSync('uv', ['run', '--no-project', path.join(ROOT, 'out/build123d-performance/reference-venv/bin/python'), '-B', '-c', program, ROOT, dir], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /four native and STEP blends satisfy the unchanged contract/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
