#!/usr/bin/env node
// Visual-quality evidence for the rendering audit: screenshots plus pixel
// samples (lighting contrast, selection/hover contrast, handedness check,
// far-from-origin precision). Uses the same probe as audit-render-bench.mjs;
// viewer/app.js itself is not modified.
//
// node scripts/viewer/audit-render-shots.mjs --url http://127.0.0.1:4347/viewer/ --out out/viewer/audit-rendering
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { probe } from './audit-probe.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const url = option('--url', 'http://127.0.0.1:4347/viewer/');
const out = option('--out', 'out/viewer/audit-rendering');
const only = option('--only', '').split(',').filter(Boolean);
const { chromium } = await import(option('--playwright', join(homedir(), '.dev-browser/node_modules/playwright-core/index.mjs')));
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = { schema: 'wonky.viewer-audit.render-shots/1', measuredAt: new Date().toISOString(), shots: {} };

async function session(dpr = 2) {
  const context = await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: dpr });
  await context.route('**/viewer/app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + probe, headers: { ...response.headers(), 'content-type': 'text/javascript; charset=utf-8' } });
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.__audit && !window.__audit.state.loading && window.__audit.state.workspace.models.length > 0, null, { timeout: 120000 });
  const box = await page.locator('#model-canvas').boundingBox();
  await page.mouse.move(2, 2);
  const models = await page.evaluate(() => Object.fromEntries(window.__audit.state.workspace.models.map(m => [m.label, m.id])));
  const open = label => page.evaluate(id => window.__audit.open(id, { cold: false }), models[label]);
  const camera = async value => { await page.evaluate(v => window.__audit.setCamera(v), value); await page.evaluate(() => window.__audit.frames(3)); };
  const project = point => page.evaluate(p => window.__audit.project(p), point);
  const sample = async points => {
    await page.evaluate(p => { window.__audit.samplePoints = p; window.__audit.scheduleDraw(); }, points);
    await page.evaluate(() => window.__audit.frames(3));
    return page.evaluate(() => { const pixels = window.__audit.pixels; window.__audit.samplePoints = null; return pixels; });
  };
  const shot = async (name, clip) => {
    const path = join(out, `${name}.png`);
    if (clip) await page.screenshot({ path, clip: { x: box.x + clip.x, y: box.y + clip.y, width: clip.width, height: clip.height } });
    else await page.locator('#stage').screenshot({ path });
    return path;
  };
  return { context, page, box, models, open, camera, project, sample, shot };
}

// sRGB relative luminance and CIE76 Lab difference for reported pixels.
const linear = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(3); };
const lab = rgb => {
  const [r, g, b] = rgb.map(linear);
  const xyz = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883];
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const [fx, fy, fz] = xyz.map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const deltaE = (a, b) => +Math.hypot(...lab(a).map((v, i) => v - lab(b)[i])).toFixed(2);
const want = name => !only.length || only.includes(name);

const s = await session(2);
const iso = { yaw: -.65, pitch: -.55, zoom: 1, pan: [0, 0] };

if (want('overview')) {
  for (const label of ['r10b-retained', 'P10-y4', 'r10b-first-failure-inputs', 'bored-spacer', 'four-holes', 'visual-after', 'bracket', 'stress-r10b-4x4']) {
    await s.open(label); await s.camera(iso);
    results.shots[`overview-${label}`] = await s.shot(`overview-${label}`);
  }
}

if (want('handedness')) {
  // examples/bracket.fs sketches an L: long leg along +X to x=50, short leg along +Y to y=40.
  await s.open('bracket');
  const top = { yaw: 0, pitch: -Math.PI / 2, zoom: 1, pan: [0, 0] }, front = { yaw: 0, pitch: 0, zoom: 1, pan: [0, 0] };
  await s.camera(top);
  const origin = await s.project([0, 0, 8]), xTip = await s.project([50, 0, 8]), yTip = await s.project([0, 40, 8]);
  results.handedness = { preset: 'Top view (yaw 0, pitch -90deg)', screenOfOrigin: origin, screenOfXTip: xTip, screenOfYTip: yTip,
    xPointsRight: xTip.x > origin.x, yPointsUp: yTip.y < origin.y };
  // Select the vertex at the end of the +Y leg so the inspector shows its coordinates in the screenshot.
  const vertexIndex = await s.page.evaluate(() => { const scene = window.__audit.state.scenes.get(window.__audit.state.after); return scene.bodies[0].vertices.find(v => Math.abs(v.point[0]) < 1e-9 && Math.abs(v.point[1] - 40) < 1e-9 && Math.abs(v.point[2] - 8) < 1e-9)?.index; });
  await s.page.evaluate(i => { const st = window.__audit.state; window.__audit.selectReference({ modelId: st.after, bodyId: st.scenes.get(st.after).bodies[0].id, entityType: 'vertex', entityIndex: i }); }, vertexIndex);
  await s.page.evaluate(() => window.__audit.frames(3));
  await s.page.screenshot({ path: join(out, 'handedness-bracket-top-page.png') });
  results.shots['handedness-bracket-top-page'] = join(out, 'handedness-bracket-top-page.png');
  await s.page.evaluate(() => window.__audit.selectReference(null));
  results.shots['handedness-bracket-top'] = await s.shot('handedness-bracket-top');
  await s.camera(front);
  results.handedness.front = { preset: 'Front view (yaw 0, pitch 0)', towardViewerIsPlusY: true,
    screenOfX50: await s.project([50, 0, 0]), screenOfZ8: await s.project([0, 0, 8]) };
  results.shots['handedness-bracket-front'] = await s.shot('handedness-bracket-front');
  // Determinant of the view basis (screen right, screen up, toward viewer) in world coordinates.
  results.handedness.basisDeterminant = await s.page.evaluate(() => {
    const { yaw, pitch } = window.__audit.state.camera;
    const view = p => { const c = Math.cos(yaw), s = Math.sin(yaw), a = p[0] * c - p[1] * s, b = p[0] * s + p[1] * c; return [a, b * Math.sin(pitch) + p[2] * Math.cos(pitch), b * Math.cos(pitch) - p[2] * Math.sin(pitch)]; };
    const m = [view([1, 0, 0]), view([0, 1, 0]), view([0, 0, 1])];
    return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  });
}

if (want('report-match')) {
  // Same model and same named view as out/visual-comparison/1-after.png ("top (+Z)", matplotlib, right-handed).
  await s.open('visual-after');
  await s.camera({ yaw: 0, pitch: -Math.PI / 2, zoom: 1, pan: [0, 0] });
  results.shots['handedness-visual-after-top'] = await s.shot('handedness-visual-after-top');
}

if (want('lighting')) {
  await s.open('bracket'); await s.camera(iso);
  const points = { 'x=0 face (-X normal)': [0, 26, 4], 'y=12 face (+Y normal)': [40, 12, 4], 'top face (+Z normal)': [30, 6, 8] };
  const screen = []; for (const p of Object.values(points)) { const q = await s.project(p); screen.push([q.x, q.y]); }
  const pixels = await s.sample(screen);
  const faces = Object.fromEntries(Object.keys(points).map((k, i) => [k, { rgb: pixels[i].slice(0, 3), luminance: +luminance(pixels[i]).toFixed(4) }]));
  const values = Object.values(faces);
  results.lighting = { model: 'bracket', camera: 'default iso', faces,
    maxFaceContrastRatio: Math.max(...values.flatMap(a => values.map(b => contrast(a.rgb, b.rgb)))),
    minFaceDeltaE: Math.min(...values.flatMap((a, i) => values.filter((_, j) => j > i).map(b => deltaE(a.rgb, b.rgb)))),
    edgeColor: [82, 110, 82] };
  results.lighting.edgeToFaceContrast = values.map(v => contrast(v.rgb, [82, 110, 82]));
  results.shots['lighting-bracket-iso'] = await s.shot('lighting-bracket-iso');
  await s.page.evaluate(() => window.__audit.showEdges(false)); await s.page.evaluate(() => window.__audit.frames(3));
  results.shots['lighting-bracket-iso-noedges'] = await s.shot('lighting-bracket-iso-noedges');
  await s.page.evaluate(() => window.__audit.showEdges(true));
  // Selection and hover colors on the top face.
  const topFace = await s.page.evaluate(() => { const st = window.__audit.state, body = st.scenes.get(st.after).bodies[0]; return body.faces.find(f => f.triangles.length && f.triangles[0].normal[2] > 0.9)?.index; });
  const at = await s.project(points['top face (+Z normal)']);
  const reference = await s.page.evaluate(i => { const st = window.__audit.state; return { modelId: st.after, bodyId: st.scenes.get(st.after).bodies[0].id, entityType: 'face', entityIndex: i }; }, topFace);
  const base = (await s.sample([[at.x, at.y]]))[0];
  await s.page.evaluate(r => window.__audit.hoverReference(r), reference);
  const hover = (await s.sample([[at.x, at.y]]))[0];
  results.shots['hover-face-bracket'] = await s.shot('hover-face-bracket');
  await s.page.evaluate(() => window.__audit.hoverReference(null));
  await s.page.evaluate(r => window.__audit.selectReference(r), reference);
  const selected = (await s.sample([[at.x, at.y]]))[0];
  results.shots['select-face-bracket'] = await s.shot('select-face-bracket');
  await s.page.evaluate(() => window.__audit.selectReference(null));
  results.selection = { base: base.slice(0, 3), hover: hover.slice(0, 3), selected: selected.slice(0, 3),
    hoverDeltaE: deltaE(base, hover), selectedDeltaE: deltaE(base, selected), hoverContrast: contrast(base, hover), selectedContrast: contrast(base, selected) };
}

if (want('silhouette')) {
  await s.open('bored-spacer');
  await s.camera({ yaw: 0, pitch: 0, zoom: 1, pan: [0, 0] });
  results.shots['silhouette-spacer-front'] = await s.shot('silhouette-spacer-front');
  await s.camera({ yaw: -.65, pitch: -.25, zoom: 1, pan: [0, 0] });
  results.shots['silhouette-spacer-low-iso'] = await s.shot('silhouette-spacer-low-iso');
  await s.open('P10-y4'); await s.camera({ yaw: -.4, pitch: -.3, zoom: 3.2, pan: [0.18, -0.02] });
  results.shots['silhouette-p10-zoom'] = await s.shot('silhouette-p10-zoom');
}

if (want('edges')) {
  await s.open('r10b-retained'); await s.camera({ ...iso, zoom: 2.5 });
  results.shots['edges-r10b-zoom'] = await s.shot('edges-r10b-zoom');
  results.shots['edges-r10b-zoom-crop'] = await s.shot('edges-r10b-zoom-crop', { x: 240, y: 150, width: 180, height: 140 });
  await s.page.evaluate(() => window.__audit.showEdges(false)); await s.page.evaluate(() => window.__audit.frames(3));
  results.shots['edges-r10b-zoom-noedges'] = await s.shot('edges-r10b-zoom-noedges');
  await s.page.evaluate(() => window.__audit.showEdges(true));
  await s.camera({ yaw: 0.02, pitch: -0.03, zoom: 2.5, pan: [0, 0] });
  results.shots['edges-r10b-grazing'] = await s.shot('edges-r10b-grazing');
}

if (want('zoom')) {
  // Maximum zoom (camera.zoom clamp 25) on the largest scene: the smallest reachable field of view.
  await s.open('stress-r10b-4x4'); await s.camera({ ...iso, zoom: 25 });
  results.zoom = { stress4x4: await s.page.evaluate(() => ({ extent: window.__audit.state.extent, cssPxPerMm: window.__audit.cameraFactor(), fieldMm: Math.min(document.querySelector('#model-canvas').clientWidth, document.querySelector('#model-canvas').clientHeight) / window.__audit.cameraFactor() })) };
  results.shots['zoom-stress4x4-max'] = await s.shot('zoom-stress4x4-max');
  await s.open('r10b-retained'); await s.camera({ ...iso, zoom: 25 });
  results.zoom.r10b = await s.page.evaluate(() => ({ extent: window.__audit.state.extent, cssPxPerMm: window.__audit.cameraFactor(), fieldMm: Math.min(document.querySelector('#model-canvas').clientWidth, document.querySelector('#model-canvas').clientHeight) / window.__audit.cameraFactor() }));
}

if (want('precision')) {
  // Same 10 mm spacer at the origin and translated by 20 m / 100 m, top view, max zoom on the outer rim at +X.
  results.precision = {};
  for (const label of ['bored-spacer', 'far-bored-spacer', 'far1e5-bored-spacer']) {
    await s.open(label);
    const info = await s.page.evaluate(() => ({ center: window.__audit.state.center, extent: window.__audit.state.extent }));
    const target = [info.center[0] + 5 * Math.SQRT1_2, info.center[1] + 5 * Math.SQRT1_2, 10];
    const rel = target.map((v, i) => v - info.center[i]);
    // top view: yaw 0, pitch -90deg => screen right = x, screen up = -y
    await s.camera({ yaw: 0, pitch: -Math.PI / 2, zoom: 25, pan: [-rel[0] / info.extent, rel[1] / info.extent] });
    const edge = await s.page.evaluate(() => { const st = window.__audit.state, body = st.scenes.get(st.after).bodies[0]; const e = body.edges.find(e => e.curveType === 'circle' && e.points.some(p => Math.abs(p[2] - 10) < 1e-6) && Math.max(...e.points.map(p => Math.hypot(p[0] - st.center[0], p[1] - st.center[1]))) > 4.9); return { modelId: st.after, bodyId: body.id, entityType: 'edge', entityIndex: e.index }; });
    await s.page.evaluate(r => window.__audit.selectReference(r), edge);
    await s.page.evaluate(() => window.__audit.frames(3));
    const maxRounding = await s.page.evaluate(() => { const st = window.__audit.state, body = st.scenes.get(st.after).bodies[0]; let m = 0; for (const f of body.faces) for (const t of f.triangles) for (const p of t.points) for (const v of p) m = Math.max(m, Math.abs(Math.fround(v) - v)); return m; });
    results.precision[label] = { center: info.center, maxFloat32RoundingMm: maxRounding, cssPxPerMm: await s.page.evaluate(() => window.__audit.cameraFactor()) };
    results.precision[label].maxRoundingCssPx = maxRounding * results.precision[label].cssPxPerMm;
    results.shots[`precision-${label}`] = await s.shot(`precision-${label}`, { x: 250, y: 150, width: 500, height: 400 });
    await s.page.evaluate(() => window.__audit.selectReference(null));
  }
}
await s.context.close();

if (want('dpr1')) {
  const one = await session(1);
  await one.open('r10b-retained'); await one.camera({ ...iso, zoom: 2.5 });
  results.shots['edges-r10b-zoom-crop-dpr1'] = await one.shot('edges-r10b-zoom-crop-dpr1', { x: 240, y: 150, width: 180, height: 140 });
  await one.context.close();
}
await browser.close();
const file = join(out, `render-shots${only.length ? '-' + only.join('-') : ''}.json`);
await writeFile(file, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ handedness: results.handedness, lighting: results.lighting, selection: results.selection, zoom: results.zoom, precision: results.precision }, null, 1));
