// Owner-boundary contracts: real STL input -> comparable PNG output. No kernel
// suite covers this renderer. Guards format decoding, depth occlusion and the
// regression where fitting engines independently hides a geometry-size error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { readStl, meshMetrics, render, fitCamera, renderPair } from './render.mjs';
const output = fileURLToPath(new URL('../../../out/site/data/', import.meta.url));
mkdirSync(output, { recursive: true });
function workspace(t) { const p = mkdtempSync(join(output, 'renderer-check-')); t.after(() => rmSync(p, { recursive: true, force: true })); return p; }
const tetra = [[[0,0,0],[0,1,0],[1,0,0]], [[0,0,0],[1,0,0],[0,0,1]], [[0,0,0],[0,0,1],[0,1,0]], [[1,0,0],[0,1,0],[0,0,1]]];
function ascii(mesh) { return `solid check\n${mesh.map(t => `facet normal 0 0 0\nouter loop\n${t.map(p => 'vertex ' + p.join(' ')).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid check\n`; }
function binary(mesh) { const b = Buffer.alloc(84 + mesh.length * 50); b.writeUInt32LE(mesh.length, 80); mesh.forEach((t,i) => t.flat().forEach((v,k) => b.writeFloatLE(v, 84+i*50+12+k*4))); return b; }
function decode(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  const idat = []; let width, height;
  for (let p=8; p<png.length;) { const n=png.readUInt32BE(p), type=png.toString('ascii',p+4,p+8), data=png.subarray(p+8,p+8+n); if(type==='IHDR') { width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);assert.equal(data[9],2); } if(type==='IDAT') idat.push(data);p+=12+n; }
  const scan = inflateSync(Buffer.concat(idat)); assert.equal(scan.length, height*(1+width*3));
  const pixels=Buffer.alloc(width*height*3);
  for(let y=0;y<height;y++) { assert.equal(scan[y*(1+width*3)],0);scan.copy(pixels,y*width*3,y*(1+width*3)+1,(y+1)*(1+width*3)); }
  return {width,height,pixels};
}

test('ASCII and binary STL preserve a translated oriented solid and its physical volume', t => {
  const dir=workspace(t), translated=tetra.map(tri=>tri.map(p=>p.map((v,k)=>v+[200,-150,75][k])));
  for(const [ext,bytes] of [['ascii',ascii(translated)],['binary',binary(translated)]]) {
    const file=join(dir,ext+'.stl');writeFileSync(file,bytes);const mesh=readStl(file);
    assert.deepEqual(mesh,translated);
    const m=meshMetrics(mesh);assert.equal(m.triangles,4);assert.ok(Math.abs(m.signedMeshVolumeMm3-1/6)<1e-12);assert.deepEqual(m.boundsMm,[[200,-150,75],[201,-149,76]]);
  }
  const bad=join(dir,'bad.stl');writeFileSync(bad,'solid bad\nvertex 0 0 0\nendsolid bad');assert.throws(()=>readStl(bad),/Incomplete/);
});

test('PNG is deterministic and z-buffer shows the nearer surface independent of draw order', () => {
  const back=[[0,0,0],[0,30,0],[30,0,0]];
  const front=[back[0],back[2],back[1]].map(p=>p.map((v,k)=>v+[10,-10,10][k]));
  const camera=fitCamera([[back,front]]), frontOnly=render([front],camera), both=render([front,back],camera), reversed=render([back,front],camera);
  assert.deepEqual(both.png,reversed.png);assert.deepEqual(both.png,frontOnly.png);assert.deepEqual(both.png,render([front,back],camera).png);
  const image=decode(both.png);assert.equal(image.width,480);assert.equal(image.height,360);
  assert.deepEqual([...image.pixels.subarray(0,3)],[238,241,243]);
  assert.ok(both.drawnPixels>1000 && both.drawnPixels<480*360);
});

test('paired renders preserve a scale discrepancy instead of auto-normalizing both models', t => {
  const dir=workspace(t), ref=join(dir,'ref.stl'), wonky=join(dir,'wonky.stl'), r=join(dir,'ref.png'), w=join(dir,'wonky.png');
  writeFileSync(ref,ascii(tetra));writeFileSync(wonky,ascii(tetra.map(tri=>tri.map(p=>p.map(v=>v*0.5)))));
  const pair=renderPair(ref,wonky,r,w);
  assert.ok(pair.wonky.drawnPixels/pair.reference.drawnPixels>0.24);
  assert.ok(pair.wonky.drawnPixels/pair.reference.drawnPixels<0.26);
  assert.equal(decode(readFileSync(r)).width,decode(readFileSync(w)).width);
  assert.ok(Math.abs(pair.wonky.signedMeshVolumeMm3/pair.reference.signedMeshVolumeMm3-0.125)<1e-12);
});
