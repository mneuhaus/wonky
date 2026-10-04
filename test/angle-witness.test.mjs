import test from 'node:test';
import assert from 'node:assert/strict';
import { Quantity, binary } from '../src/values.mjs';
import { scalarBuiltins } from '../src/scalars.mjs';
import { attachAngleWitness, tangentWitness, witnessWord } from '../src/angle-witness.mjs';
const degree = scalarBuiltins().degree;
test('degree witnesses preserve binary64 arithmetic and old sentinels', () => {
 for (const k of [1,15,30,45,60,90,135,360,-90,0.1]) {
  const v=binary('*',k,degree);
  assert.equal(v.value,k*(Math.PI/180));
  assert.equal(v.angleWitness.kind,'Turns');
  assert.equal(witnessWord(v.angleWitness),v.value);
 }
 assert.equal(binary('*',90,degree).value,Math.PI/2);
 assert.equal(binary('*',360,degree).value,2*Math.PI);
 const half=binary('/',binary('*',90,degree),2);
 assert.deepEqual(half.angleWitness,{kind:'Turns',numerator:'1',denominator:'8'});
 assert.equal(Object.keys(half).includes('angleWitness'),false);
 for (const k of [Number.MIN_VALUE, 2 ** -1022, Number.MAX_VALUE]) {
  const v=binary('*',k,degree);
  assert.equal(v.value,k*(Math.PI/180));
  assert.equal(witnessWord(v.angleWitness),v.value);
 }
 assert.throws(()=>binary('/',binary('*',90,degree),0),{code:'fs/invalid-argument'});
 assert.throws(()=>binary('*',Infinity,degree),{code:'fs/invalid-argument'});
});
test('only reproducible constructions propagate a witness', () => {
 const plain=new Quantity(Math.PI/3,0,1);
 assert.equal(plain.angleWitness,undefined);
 const tan=attachAngleWitness(new Quantity(Math.atan(0.125),0,1),tangentWitness(0.125));
 assert.deepEqual(tan.angleWitness,{kind:'Tan',numerator:'1',denominator:'8'});
 assert.equal(witnessWord(tan.angleWitness),tan.value);
 assert.equal(binary('*',2,tan).angleWitness,undefined);
 assert.equal(binary('*',-1,tan).value,witnessWord(binary('*',-1,tan).angleWitness));
});
test('the FeatureScript atan builtin attaches its exact dyadic argument', async () => {
 const { ModelingContext } = await import('../src/library.mjs');
 const value=new ModelingContext(null).builtins().atan.call([0.125]);
 assert.deepEqual(value.angleWitness,{kind:'Tan',numerator:'1',denominator:'8'});
 assert.equal(value.value,Math.atan(0.125));
 const infinite=new ModelingContext(null).builtins().atan.call([Infinity]);
 assert.equal(infinite.value,Math.PI/2);assert.equal(infinite.angleWitness,undefined);
 const negativeZero=new ModelingContext(null).builtins().atan.call([-0]);
 assert.ok(Object.is(negativeZero.value,-0));assert.equal(negativeZero.angleWitness,undefined);
});
test('the live Rust verifier refuses a forged word with a capability error', async () => {
 const { spawnSync }=await import('node:child_process');
 const { fileURLToPath }=await import('node:url');
 const root=fileURLToPath(new URL('../',import.meta.url));
 const run=spawnSync(process.execPath,['scripts/rust/build-node.mjs'],{cwd:root,encoding:'utf8',maxBuffer:64<<20});
 process.stdout.write(run.stdout??'');process.stderr.write(run.stderr??'');
 assert.equal(run.status,0,run.stdout+run.stderr);
 const { openRustKernel }=await import('../src/native/rust-kernel.mjs');
 const { verifyAngleWitness, RustCapabilityError, rustHostOf }=await import('../src/native/rust-host.mjs');
 const { kernel }=await openRustKernel();
 const angle=binary('*',135,degree);
 verifyAngleWitness(kernel,angle);
 const words=new DataView(new ArrayBuffer(8));words.setFloat64(0,angle.value);words.setBigUint64(0,words.getBigUint64(0)+1n);
 const forged=attachAngleWitness(new Quantity(words.getFloat64(0),0,1),angle.angleWitness);
 assert.throws(()=>verifyAngleWitness(kernel,forged),error=>error instanceof RustCapabilityError && error.reason==='angle/witness-mismatch');
 const addon=rustHostOf(kernel).addon;
 for (const k of [90,360]) {const v=binary('*',k,degree);assert.equal(addon.angleWitness(v.value,v.angleWitness.kind,v.angleWitness.numerator,v.angleWitness.denominator),'')}
 for (const k of [Number.MIN_VALUE,Number.MIN_VALUE*1024,2 ** -1022,Number.MAX_VALUE]) {
  const v=binary('*',k,degree);
  assert.equal(addon.angleWitness(v.value,v.angleWitness.kind,v.angleWitness.numerator,v.angleWitness.denominator),'',`degree(${k})`);
 }
 for (const x of [0,Number.MIN_VALUE,2 ** -1022,0.125,0.1,1/3,1,-1,1e-10,1000,Number.MAX_VALUE]) {
  const tan=attachAngleWitness(new Quantity(Math.atan(x),0,1),tangentWitness(x));
  assert.equal(addon.angleWitness(tan.value,'Tan',tan.angleWitness.numerator,tan.angleWitness.denominator),'',`atan(${x})`);
  verifyAngleWitness(kernel,tan);
 }
 assert.equal(addon.angleWitness(1,'Turns','1','0'),'angle/witness-mismatch');
 let seed=20261003n;
 const mask=(1n<<64n)-1n;
 for (let i=0;i<10000;i++) {
  seed=(seed*6364136223846793005n+1442695040888963407n)&mask;
  words.setBigUint64(0,seed);
  const x=words.getFloat64(0);
  if (!Number.isFinite(x) || Object.is(x,-0)) {i--;continue;}
  const witness=tangentWitness(x);
  assert.equal(addon.angleWitness(Math.atan(x),'Tan',witness.numerator,witness.denominator),'',`atan word ${seed.toString(16)}`);
 }
 const witness=tangentWitness(0.1);
 words.setFloat64(0,Math.atan(0.1));words.setBigUint64(0,words.getBigUint64(0)+1n);
 assert.equal(addon.angleWitness(words.getFloat64(0),'Tan',witness.numerator,witness.denominator),'angle/witness-mismatch');
 // The raw-word distribution above is dominated by tiny/huge inputs. Keep it,
 // and also cover the reviewer's moderate-magnitude distribution, where Node
 // builds disagree with the fdlibm port in the last bit.
 seed=99173n;
 const rnd=()=>{seed=(seed*6364136223846793005n+1442695040888963407n)&mask;return Number(seed>>11n)/2**53;};
 let checked=0;
 for (let i=0;i<40000;i++) {
  const x=(rnd()*2-1)*2**(Math.floor(rnd()*16)-8);
  const w=tangentWitness(x);
  assert.equal(addon.angleWitness(Math.atan(x),'Tan',w.numerator,w.denominator),'',`moderate atan(${x})`);
  words.setFloat64(0,Math.atan(x));const genuineBits=words.getBigUint64(0);
  for (const delta of [-1n,1n]) {
   words.setBigUint64(0,genuineBits+delta);
   assert.equal(addon.angleWitness(words.getFloat64(0),'Tan',w.numerator,w.denominator),'angle/witness-mismatch',`moderate forged atan(${x}), delta ${delta}`);
  }
  checked++;
 }
 console.log(`moderate atan witnesses: ${checked} checked, 0 mismatches`);
 for (const x of [0.1,-0.1,0.3423920292037649,-0.41604472810881155,2.9206200710235235,-0.3874059588898999]) {
  const w=tangentWitness(x);
  words.setFloat64(0,Math.atan(x));const bits=words.getBigUint64(0);
  for (const delta of [-2n,-1n,1n,2n]) {
   words.setBigUint64(0,bits+delta);
   assert.equal(addon.angleWitness(words.getFloat64(0),'Tan',w.numerator,w.denominator),'angle/witness-mismatch',`forged atan(${x}), delta ${delta}`);
  }
 }
});
test('the independent SymPy oracle remains bound to its frozen bytes', async () => {
 const fs=await import('node:fs');const { createHash }=await import('node:crypto');
 const directory=new URL('../fixtures/turn-signs/',import.meta.url);
 const provenance=JSON.parse(fs.readFileSync(new URL('provenance.json',directory)));
 const sha=file=>createHash('sha256').update(fs.readFileSync(new URL(file,directory))).digest('hex');
 assert.equal(sha('sympy.tsv'),provenance.dataSha256);assert.equal(sha('generate.py'),provenance.generatorSha256);
 assert.equal(provenance.count,10000);assert.equal(provenance.sympyVersion,'1.14.0');
});
