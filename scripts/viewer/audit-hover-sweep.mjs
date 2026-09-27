#!/usr/bin/env node
// Rendering audit: frame rate while the mouse sweeps over a model with hover
// preview active. node scripts/viewer/audit-hover-sweep.mjs <viewer-url> label=<modelId> ...
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { probe } from './audit-probe.mjs';
const { chromium } = await import(join(homedir(), '.dev-browser/node_modules/playwright-core/index.mjs'));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 });
await context.route('**/viewer/app.js', async route => { const r = await route.fetch(); await route.fulfill({ response: r, body: (await r.text()) + probe, headers: { ...r.headers(), 'content-type': 'text/javascript; charset=utf-8' } }); });
const page = await context.newPage();
const url = process.argv[2] ?? 'http://127.0.0.1:4347/viewer/';
await page.goto(url);
await page.waitForFunction(() => window.__audit && !window.__audit.state.loading && window.__audit.state.workspace.models.length > 0);
const box = await page.locator('#model-canvas').boundingBox();
const out = {};
// Models: label=id pairs after the URL.
const pairs = process.argv.slice(3).map(pair => pair.split('='));
for (const [label, id] of pairs) {
  await page.evaluate(id => window.__audit.open(id, { cold: false }), id);
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.evaluate(() => { const a = window.__audit; a.reset(); a.frameTimes = []; a.counting = true; const tick = t => { a.frameTimes.push(t); if (a.counting) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const started = Date.now();
  for (let i = 0; i < 240; i++) { await page.mouse.move(box.x + box.width * (0.25 + 0.5 * i / 240), box.y + box.height * (0.4 + 0.2 * Math.sin(i / 15))); await new Promise(r => setTimeout(r, 8)); }
  const ms = Date.now() - started;
  const r = await page.evaluate(() => { const a = window.__audit; a.counting = false; const f = a.frameTimes; const gaps = f.slice(1).map((t, i) => t - f[i]); return { frames: f.length, maxGap: Math.max(...gaps), picks: (a.samples.pick ?? []).length }; });
  out[label] = { sweepMs: ms, framesPerSecond: +(r.frames / (ms / 1000)).toFixed(1), maxFrameGapMs: +r.maxGap.toFixed(1), picks: r.picks };
  console.log(label, JSON.stringify(out[label]));
}
await writeFile('out/viewer/audit-rendering/hover-sweep.json', JSON.stringify({ schema: 'wonky.viewer-audit.hover-sweep/1', measuredAt: new Date().toISOString(), note: 'Mouse moved continuously over the model without buttons (hover preview active), ~120 Hz CDP input for ~2.5 s; frames = requestAnimationFrame callbacks.', results: out }, null, 2) + '\n');
await browser.close();
