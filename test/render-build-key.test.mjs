import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {KEY_SCRIPTS} from '../src/native/rust-build-key.mjs';
import {renderKey,rendererMatches} from '../src/native/render-build-key.mjs';

test('renderer key covers sources, compiler, environment and Cargo configuration',t=>{
  const root=mkdtempSync(join(tmpdir(),'wonky-render-key-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const put=(p,text)=>{const path=join(root,p);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,text);};
  for(const p of [...KEY_SCRIPTS,'rust/Cargo.toml','render/wonky-render/Cargo.toml','render/wonky-render/Cargo.lock','render/wonky-render/src/main.rs','scripts/rust/build-render.mjs','src/native/render-build-key.mjs'])put(p,p);
  const tools={rustc:'compiler A',cargo:'cargo A'},key=()=>renderKey(root,{tools,env:{}});
  const baseline=key();
  assert.notEqual(renderKey(root,{tools:{...tools,rustc:'compiler B'},env:{}}).sourceHash,baseline.sourceHash);
  assert.notEqual(renderKey(root,{tools,env:{RUSTFLAGS:'-C opt-level=0'}}).sourceHash,baseline.sourceHash);
  assert.equal(renderKey(root,{tools,env:{RUSTC_WRAPPER:'sccache'}}).sourceHash,baseline.sourceHash);
  for(const p of ['render/wonky-render/src/main.rs','rust/Cargo.toml','scripts/rust/build-node.mjs']){
    put(p,'edited');assert.notEqual(key().sourceHash,baseline.sourceHash);put(p,p);
  }
  put('render/.cargo/config.toml','[build]\nrustflags = ["--cfg", "changed"]');
  assert.notEqual(key().sourceHash,baseline.sourceHash);
});

test('renderer integrity requires the keyed hash inside the actual artifact',t=>{
  const root=mkdtempSync(join(tmpdir(),'wonky-render-integrity-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,'binary'),key={schema:'wonky-render-build/2',sourceHash:'a'.repeat(64)};
  const bytes=Buffer.from(`binary:${key.sourceHash}`);
  writeFileSync(path,bytes);
  // A unit-level artifact, not live renderer proof.
  return import('../src/native/rust-build-key.mjs').then(({sha256})=>{
    const manifest={...key,binaryHash:sha256(bytes),binaryBytes:bytes.length};
    assert.equal(rendererMatches(path,manifest,key),true);
    writeFileSync(path,'tampered');assert.equal(rendererMatches(path,manifest,key),false);
    const unkeyed=Buffer.from('wrong build');writeFileSync(path,unkeyed);
    assert.equal(rendererMatches(path,{...manifest,binaryHash:sha256(unkeyed),binaryBytes:unkeyed.length},key),false);
  });
});
