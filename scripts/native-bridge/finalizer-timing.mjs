#!/usr/bin/env node
// Does a FinalizationRegistry callback ever run while JS stays synchronous, as the FeatureScript
// interpreter does for a whole build? Forced GCs included. Evidence for the handle-lifetime design in
// docs/native-bridge/proposal-resident.md (section 5). Writes out/native-bridge/resident/finalizer-timing.json.
//   node --expose-gc scripts/native-bridge/finalizer-timing.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
if (typeof globalThis.gc !== 'function') throw new Error('run with node --expose-gc');
let fired = 0;
const registry = new FinalizationRegistry(() => { fired += 1; });
const churn = n => { for (let i = 0; i < n; i++) registry.register({ payload: new Array(64).fill(i) }, i); };
churn(20000);
for (let i = 0; i < 20; i++) { globalThis.gc(); churn(1000); }
const firedDuringSynchronousPhase = fired;
await new Promise(resolve => setTimeout(resolve, 0));
globalThis.gc();
await new Promise(resolve => setTimeout(resolve, 20));
const result = { schema: 'wonky-finalizer-timing/1', node: process.version, registered: 40000, forcedGcsDuringSynchronousPhase: 20,
  firedDuringSynchronousPhase, firedAfterEventLoopTurns: fired, at: new Date().toISOString() };
const dir = new URL('../../out/native-bridge/resident/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('finalizer-timing.json', dir), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
