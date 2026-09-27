#!/usr/bin/env node
// Rendering and interaction audit harness for viewer/app.js.
//
// Drives a real Chromium (ANGLE/Metal GPU, not SwiftShader) against a running
// wonky-view instance and records load, orbit, hover, pick and memory numbers.
// viewer/app.js is NOT modified: the harness intercepts the /viewer/app.js
// response inside this browser session only and appends a probe to the module
// so it can wrap draw/pick/select and read module state.
//
// node scripts/viewer/audit-render-bench.mjs --url http://127.0.0.1:4347/viewer/ \
//   --out out/viewer/audit-rendering --models <id>,<id> [--dpr 2] [--phase all]
//
// Playwright is not a project dependency. The harness imports an existing local
// playwright-core install given by --playwright (default ~/.dev-browser).
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir, loadavg } from 'node:os';
import { probe } from './audit-probe.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const url = option('--url', 'http://127.0.0.1:4347/viewer/');
const out = option('--out', 'out/viewer/audit-rendering');
const dpr = Number(option('--dpr', '2'));
const phases = option('--phase', 'all').split(',');
const models = option('--models', '').split(',').filter(Boolean);
const tag = option('--tag', `dpr${dpr}`);
const playwrightPath = option('--playwright', join(homedir(), '.dev-browser/node_modules/playwright-core/index.mjs'));
const width = Number(option('--width', '1512')), height = Number(option('--height', '945'));
const { chromium } = await import(playwrightPath);
await mkdir(out, { recursive: true });


const summary = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))];
  return { n: sorted.length, p50: +at(0.5).toFixed(3), p95: +at(0.95).toFixed(3), max: +sorted.at(-1).toFixed(3), mean: +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(3) };
};
function processMemory(rootPid) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command=']).toString().trim().split('\n').map(line => {
    const [pid, ppid, rss, ...command] = line.trim().split(/\s+/);
    return { pid: +pid, ppid: +ppid, rssKb: +rss, command: command.join(' ') };
  });
  const tree = new Set([rootPid]);
  let grew = true;
  while (grew) { grew = false; for (const row of rows) if (tree.has(row.ppid) && !tree.has(row.pid)) { tree.add(row.pid); grew = true; } }
  const kind = command => /--type=gpu-process/.test(command) ? 'gpu' : /--type=renderer/.test(command) ? 'renderer' : /--type=/.test(command) ? 'other' : 'browser';
  const result = {};
  for (const row of rows) if (tree.has(row.pid)) result[kind(row.command)] = (result[kind(row.command)] ?? 0) + row.rssKb * 1024;
  return result;
}

const server = await chromium.launchServer({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const browser = await chromium.connect(server.wsEndpoint());
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
await context.route('**/viewer/app.js', async route => {
  const response = await route.fetch();
  await route.fulfill({ response, body: (await response.text()) + probe, headers: { ...response.headers(), 'content-type': 'text/javascript; charset=utf-8' } });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(url);
await page.waitForFunction(() => window.__audit && !window.__audit.state.loading && window.__audit.state.workspace.models.length > 0, null, { timeout: 120000 });
const environment = await page.evaluate(() => {
  const gl = window.__audit.gl(), ext = gl.getExtension('WEBGL_debug_renderer_info'), canvas = document.querySelector('#model-canvas');
  return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION),
    samples: gl.getParameter(gl.SAMPLES), depthBits: gl.getParameter(gl.DEPTH_BITS), lineWidthRange: [...gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE)],
    devicePixelRatio, canvas: [canvas.width, canvas.height], cssCanvas: [canvas.clientWidth, canvas.clientHeight], timer: window.__audit.hasTimer,
    userAgent: navigator.userAgent };
});
const rootPid = server.process().pid;
const report = { schema: 'wonky.viewer-audit.render-bench/1', measuredAt: new Date().toISOString(), url, dpr, viewport: { width, height },
  loadAverage: loadavg(), environment, memoryBaseline: processMemory(rootPid), models: [] };
console.log(JSON.stringify(environment));
const canvasBox = await page.locator('#model-canvas').boundingBox();
const center = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };

for (const id of models) {
  const row = {};
  await page.mouse.move(canvasBox.x + 5, canvasBox.y + canvasBox.height - 5);
  await page.evaluate(() => window.__audit.reset());
  if (phases.includes('all') || phases.includes('load')) {
    row.transfer = await page.evaluate(id => window.__audit.transfer(id), id);
    row.open = await page.evaluate(id => window.__audit.open(id, { cold: true }), id);
    row.processMemory = processMemory(rootPid);
    console.log('open', JSON.stringify(row.open), JSON.stringify(row.transfer));
  } else row.open = await page.evaluate(id => window.__audit.open(id, { cold: false }), id);

  if (phases.includes('all') || phases.includes('orbit')) {
    // Continuous orbit with real CDP mouse input at ~120 Hz for ~3 s.
    await page.evaluate(() => { window.__audit.reset(); window.__audit.gpuTimer = true; window.__audit.gpuSync = false; });
    await page.mouse.move(center.x - 200, center.y);
    await page.mouse.down();
    const started = Date.now();
    for (let i = 0; i < 360; i++) {
      await page.mouse.move(center.x - 200 + (i % 180) * 2.2, center.y + Math.sin(i / 20) * 40);
      await new Promise(resolve => setTimeout(resolve, 8));
    }
    await page.mouse.up();
    const inputMs = Date.now() - started;
    await page.evaluate(() => window.__audit.frames(6));
    await page.evaluate(() => window.__audit.resolveQueries());
    const samples = await page.evaluate(() => window.__audit.samples);
    const draws = samples.draw ?? [];
    const intervals = draws.slice(1).map((d, i) => d.at - draws[i].at).filter(v => v < 1000);
    row.orbit = { inputMs, draws: draws.length, drawsPerSecond: +(draws.length / (inputMs / 1000)).toFixed(1),
      interval: summary(intervals), drawCpu: summary(draws.map(d => d.cpu)), gpu: summary((samples.gpu ?? []).map(g => g.ms)),
      overlay: summary((samples.overlay ?? []).map(o => o.ms)), longFrames: intervals.filter(v => v > 33.4).length };
    console.log('orbit', JSON.stringify(row.orbit));
    // Synced draw cost at a fixed camera step (CPU submit + GPU completion via readPixels).
    await page.evaluate(async () => { const a = window.__audit; a.reset(); a.gpuSync = true; a.gpuTimer = false; for (let i = 0; i < 40; i++) { a.state.camera.yaw += 0.01; a.scheduleDraw(); await a.frames(1); } a.gpuSync = false; a.gpuTimer = true; });
    const synced = await page.evaluate(() => window.__audit.samples.draw ?? []);
    row.syncedDraw = summary(synced.map(d => d.synced));
    console.log('synced', JSON.stringify(row.syncedDraw));
  }

  if (phases.includes('all') || phases.includes('hover')) {
    await page.evaluate(() => { const a = window.__audit; a.setCamera({ yaw: -.65, pitch: -.55, zoom: 1, pan: [0, 0] }); a.reset(); a.gpuSync = true; a.gpuTimer = false; });
    await page.evaluate(() => window.__audit.frames(3));
    const columns = 12, rows = 8;
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      const x = canvasBox.x + canvasBox.width * (0.2 + 0.6 * (c + 0.5) / columns), y = canvasBox.y + canvasBox.height * (0.2 + 0.6 * (r + 0.5) / rows);
      await page.mouse.move(x, y);
      await page.evaluate(() => window.__audit.frames(3));
    }
    const samples = await page.evaluate(() => window.__audit.samples);
    row.hover = { moves: columns * rows, pick: summary((samples.pick ?? []).map(p => p.ms)), highlight: summary((samples.highlight ?? []).map(p => p.ms)),
      moveToPick: summary((samples.hover ?? []).map(h => h.moveToPick)), moveToDrawn: summary((samples.hover ?? []).map(h => h.moveToDrawn)),
      hits: (samples.pick ?? []).reduce((m, p) => { m[p.hit ?? 'none'] = (m[p.hit ?? 'none'] ?? 0) + 1; return m; }, {}) };
    console.log('hover', JSON.stringify(row.hover));
    // Click-select: pointerdown -> select() (pick + highlight + inspector DOM) -> drawn frame.
    await page.evaluate(() => { window.__audit.reset(); });
    for (let i = 0; i < 12; i++) {
      const x = canvasBox.x + canvasBox.width * (0.3 + 0.4 * (i % 4) / 3), y = canvasBox.y + canvasBox.height * (0.35 + 0.3 * Math.floor(i / 4) / 2);
      await page.mouse.click(x, y);
      await page.evaluate(() => window.__audit.frames(3));
    }
    const clicks = await page.evaluate(() => window.__audit.samples);
    row.click = { select: summary((clicks.select ?? []).filter(s => s.type).map(s => s.ms)), clickToDrawn: summary((clicks.selectFrame ?? []).map(s => s.clickToDrawn)),
      pick: summary((clicks.pick ?? []).map(p => p.ms)) };
    console.log('click', JSON.stringify(row.click));
    await page.evaluate(() => { window.__audit.selectReference(null); window.__audit.gpuSync = false; window.__audit.gpuTimer = true; });
  }
  report.models.push(row);
}

if (phases.includes('all') || phases.includes('cache')) {
  // The viewer caches every opened scene and its GPU buffers for the page lifetime.
  const before = await page.evaluate(() => window.__audit.heap());
  for (const id of models) await page.evaluate(id => window.__audit.open(id, { cold: false }), id);
  report.cache = { heapBefore: before, heapAfterAll: await page.evaluate(() => window.__audit.heap()), cachedScenes: await page.evaluate(() => window.__audit.state.scenes.size),
    bufferBytes: await page.evaluate(() => window.__audit.bufferBytes()), processMemory: processMemory(rootPid) };
  console.log('cache', JSON.stringify(report.cache));
}
report.errors = errors;
report.loadAverageAfter = loadavg();
await writeFile(join(out, `render-bench-${tag}.json`), JSON.stringify(report, null, 2) + '\n');
await browser.close();
await server.close();
console.log('errors', errors.length, errors.slice(0, 3));
